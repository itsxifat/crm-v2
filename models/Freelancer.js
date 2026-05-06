import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const FreelancerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    type:   { type: String, enum: ['FREELANCER', 'AGENCY'], default: 'FREELANCER' },

    // Profile — stored encrypted
    skills:         { type: String, default: null },
    bio:            { type: String, default: null },
    portfolioLinks: { type: String, default: null },

    // Wallet — numeric aggregates used for balance calculations; kept plaintext
    walletBalance:       { type: Number, default: 0 },
    pendingBalance:      { type: Number, default: 0 },
    withdrawableBalance: { type: Number, default: 0 },

    // Rate — stored encrypted
    rateType:   { type: String, default: null },
    hourlyRate: { type: mongoose.Schema.Types.Mixed, default: null }, // encrypted Number

    paymentMethod: {
      method: { type: String, enum: ['BANK', 'BKASH', null], default: null },
      bank: {
        bankName:      { type: String, default: null }, // encrypted
        accountNumber: { type: String, default: null }, // encrypted
        accountName:   { type: String, default: null }, // encrypted
        routingNumber: { type: String, default: null }, // encrypted
        swiftCode:     { type: String, default: null }, // encrypted
        branch:        { type: String, default: null }, // encrypted
        division:      { type: String, default: null }, // encrypted
      },
      bkash: {
        accountType:   { type: String, enum: ['Personal', 'Agent', 'Merchant'], default: 'Personal' },
        accountName:   { type: String, default: null }, // encrypted
        accountNumber: { type: String, default: null }, // encrypted
      },
    },

    // Pricing — Mixed array
    pricing: { type: mongoose.Schema.Types.Mixed, default: [] },

    agencyInfo: {
      agencyName: { type: String, default: null }, // encrypted
      phone:      { type: String, default: null }, // encrypted
      address:    { type: String, default: null }, // encrypted
      type:       { type: String, default: null }, // encrypted
    },

    contactPerson: {
      name:        { type: String, default: null }, // encrypted
      phone:       { type: String, default: null }, // encrypted
      email:       { type: String, default: null }, // encrypted
      designation: { type: String, default: null }, // encrypted
    },

    inviteToken:       { type: String, sparse: true, unique: true },
    inviteTokenExpiry: { type: Date },
    inviteAccepted:    { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

FreelancerSchema.plugin(encryptionPlugin, {
  collection: 'freelancers',
  fields: [
    { path: 'skills'          },
    { path: 'bio'             },
    { path: 'portfolioLinks'  },
    { path: 'rateType'        },
    { path: 'hourlyRate',     type: 'number' },
    { path: 'pricing',        type: 'array'  },
    // Bank
    { path: 'paymentMethod.bank.bankName'      },
    { path: 'paymentMethod.bank.accountNumber' },
    { path: 'paymentMethod.bank.accountName'   },
    { path: 'paymentMethod.bank.routingNumber' },
    { path: 'paymentMethod.bank.swiftCode'     },
    { path: 'paymentMethod.bank.branch'        },
    { path: 'paymentMethod.bank.division'      },
    // bKash
    { path: 'paymentMethod.bkash.accountName'   },
    { path: 'paymentMethod.bkash.accountNumber' },
    // Agency
    { path: 'agencyInfo.agencyName' },
    { path: 'agencyInfo.phone'      },
    { path: 'agencyInfo.address'    },
    { path: 'agencyInfo.type'       },
    // Contact person
    { path: 'contactPerson.name'        },
    { path: 'contactPerson.phone'       },
    { path: 'contactPerson.email'       },
    { path: 'contactPerson.designation' },
  ],
})

if (mongoose.models.Freelancer) delete mongoose.models.Freelancer
export default mongoose.model('Freelancer', FreelancerSchema)
